/**
 * V3-AIRFLOW: the static DAG reader. Synthetic DAG files (never run): classic operators, TaskFlow,
 * lists, chain(), set_upstream, task groups, a dynamic loop (reported, not drawn), a non-Airflow
 * file, text in strings and comments ignored, the size and task bounds, and the layered layout.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AIRFLOW_LIMITS, extractDag, kindOf, layoutDag, type DagExtraction } from "../src/core/airflow/dagExtract";

const edges = (x: DagExtraction) => x.edges.map(e => `${e.from}>${e.to}`).sort();
const ids = (x: DagExtraction) => x.tasks.map(t => t.id);
const task = (x: DagExtraction, id: string) => { const t = x.tasks.find(y => y.id === id); assert.ok(t, `task ${id} in ${ids(x).join(",")}`); return t; };

test("airflow: classic operators, dag_id, schedule, operator kinds and line ranges", () => {
  const x = extractDag(readFileSync("tests/fixtures/airflow/etl_dag.py", "utf8"));
  assert.equal(x.detected, true);
  assert.deepEqual(x.dags.map(d => [d.dagId, d.schedule]), [["etl_daily", "0 6 * * *"]]);
  assert.deepEqual(ids(x), ["wait_for_file", "extract", "transform_spark", "load_sql", "notify"]);
  assert.deepEqual(x.tasks.map(t => t.kind), ["sensor", "bash", "databricks", "sql", "notify"]);
  assert.equal(task(x, "transform_spark").operator, "DatabricksSubmitRunOperator");
  const t = task(x, "load_sql");
  assert.ok(t.endLine > t.startLine, "a multi-line operator call keeps its whole range");
  const src = readFileSync("tests/fixtures/airflow/etl_dag.py", "utf8").split("\n");
  assert.match(src[t.startLine - 1]!, /load_sql = /);
  assert.deepEqual(edges(x), ["extract>transform_spark", "transform_spark>load_sql", "load_sql>notify", "wait_for_file>extract"].sort());
  assert.deepEqual(x.unresolved, []);
});

test("airflow: TaskFlow @task functions, call nesting, repeated calls and override", () => {
  const x = extractDag(`
from airflow.decorators import dag, task
import pendulum

@dag(schedule="@daily", start_date=pendulum.datetime(2026, 1, 1), catchup=False)
def sales_taskflow():
    @task
    def extract():
        return {"a": 1}

    @task.bash
    def archive() -> str:
        return "echo done"

    @task(task_id="clean_rows")
    def clean(data):
        return data

    @task.virtualenv(requirements=["pandas"])
    def load(data):
        print(data)

    raw = extract()
    load(clean(raw))
    second = extract()
    extract.override(task_id="extract_eu")() >> archive()
    load.override(task_id="load_second")(second["a"])

sales_taskflow()
`);
  assert.equal(x.detected, true);
  assert.deepEqual(x.dags.map(d => [d.dagId, d.schedule]), [["sales_taskflow", "@daily"]]);
  assert.deepEqual(ids(x), ["extract", "clean_rows", "load", "extract__1", "extract_eu", "archive", "load_second"]);
  assert.deepEqual(edges(x), ["clean_rows>load", "extract>clean_rows", "extract__1>load_second", "extract_eu>archive"].sort());
  assert.equal(task(x, "archive").kind, "bash");
  assert.equal(task(x, "archive").operator, "@task.bash");
  assert.equal(task(x, "load").operator, "@task.virtualenv");
  const e = task(x, "extract");
  assert.equal(e.taskflow, true);
  assert.ok(e.callLine && e.callLine > e.endLine, "the call line is recorded beside the function's lines");
  assert.deepEqual(x.unresolved, []);
});

test("airflow: lists, << and chains of >>, Label, set_upstream / set_downstream", () => {
  const x = extractDag(`
from airflow import DAG
from airflow.operators.empty import EmptyOperator
from airflow.utils.edgemodifier import Label

dag = DAG("lists_dag", schedule=None)
start = EmptyOperator(task_id="start", dag=dag)
a = EmptyOperator(task_id="a", dag=dag)
b = EmptyOperator(task_id="b", dag=dag)
c = EmptyOperator(task_id="c", dag=dag)
d = EmptyOperator(task_id="d", dag=dag)
end = EmptyOperator(task_id="end", dag=dag)
start >> [a, b] >> c
d << c
d >> Label("all good") >> end
a.set_downstream(d)
end.set_upstream(b)
`);
  assert.equal(x.dags[0]!.schedule, "None (runs only when triggered)");
  assert.equal(x.dags[0]!.dagId, "lists_dag");
  assert.deepEqual(edges(x), ["a>c", "a>d", "b>c", "b>end", "c>d", "d>end", "start>a", "start>b"].sort());
  assert.deepEqual(x.unresolved, []);
});

test("airflow: chain(), chain of lists pairwise, cross_downstream", () => {
  const x = extractDag(`
from airflow.models.dag import DAG
from airflow.models.baseoperator import chain, cross_downstream
from airflow.operators.bash import BashOperator as B

with DAG(dag_id="chain_dag", schedule_interval="@hourly") as dag:
    t1, t2 = B(task_id="t1", bash_command="x"), B(task_id="t2", bash_command="x")
    p = B(task_id="p", bash_command="x")
    q = B(task_id="q", bash_command="x")
    r = B(task_id="r", bash_command="x")
    s = B(task_id="s", bash_command="x")
    u = B(task_id="u", bash_command="x")
    chain(p, [q, r], [s, u])
    cross_downstream([q, r], [u])
`);
  assert.equal(x.dags[0]!.schedule, "@hourly");
  assert.deepEqual(edges(x), ["p>q", "p>r", "q>s", "q>u", "r>u"].sort());
  assert.ok(ids(x).includes("t1") && ids(x).includes("t2"), "operators in a tuple are still tasks");
  assert.ok(x.unresolved.some(u => /several names/.test(u.reason)), JSON.stringify(x.unresolved));
});

test("airflow: task groups (with TaskGroup and @task_group) are expanded to their first and last tasks", () => {
  const x = extractDag(`
from airflow import DAG
from airflow.decorators import task_group
from airflow.operators.empty import EmptyOperator
from airflow.utils.task_group import TaskGroup

with DAG("groups", schedule="@weekly") as dag:
    start = EmptyOperator(task_id="start")
    with TaskGroup("prep") as prep:
        p1 = EmptyOperator(task_id="p1")
        p2 = EmptyOperator(task_id="p2")
        p1 >> p2

    @task_group(group_id="publish")
    def publish():
        x = EmptyOperator(task_id="x")
        y = EmptyOperator(task_id="y")
        return [x, y]

    end = EmptyOperator(task_id="end")
    start >> prep >> publish() >> end
`);
  assert.deepEqual(ids(x), ["start", "prep.p1", "prep.p2", "end", "publish.x", "publish.y"], "in the order Airflow creates them");
  assert.equal(task(x, "prep.p1").group, "prep");
  assert.equal(task(x, "prep.p1").label, "p1");
  assert.deepEqual(edges(x), ["prep.p1>prep.p2", "prep.p2>publish.x", "prep.p2>publish.y", "publish.x>end", "publish.y>end", "start>prep.p1"].sort());
  assert.deepEqual(x.unresolved, []);
});

test("airflow: tasks built in a loop, a helper function or a comprehension are reported, not guessed", () => {
  const x = extractDag(`
from airflow import DAG
from airflow.operators.bash import BashOperator
from my_company.factories import make_tasks

def make_step(name):
    return BashOperator(task_id=f"step_{name}", bash_command="x")

with DAG("dynamic") as dag:
    first = BashOperator(task_id="first", bash_command="x")
    for region in ["eu", "us"]:
        t = BashOperator(task_id=f"load_{region}", bash_command="x")
        first >> t
    helper = make_step("a")
    first >> helper
    many = [BashOperator(task_id=f"m{i}", bash_command="x") for i in range(3)]
    imported = make_tasks(dag)
    first >> imported
    computed = BashOperator(task_id="x_" + region, bash_command="x")
`);
  assert.deepEqual(ids(x), ["first"], "only the task DataPass can read for sure");
  assert.deepEqual(x.edges, []);
  const reasons = x.unresolved.map(u => `${u.startLine}: ${u.reason}`);
  assert.ok(x.unresolved.some(u => /loop/.test(u.reason) && u.startLine === 11 && u.endLine === 13), reasons.join("\n"));
  assert.ok(x.unresolved.some(u => /make_step\(\)/.test(u.reason)), reasons.join("\n"));
  assert.ok(x.unresolved.some(u => /comprehension/.test(u.reason)), reasons.join("\n"));
  assert.ok(x.unresolved.some(u => /`imported`/.test(u.reason)), reasons.join("\n"));
  assert.ok(x.unresolved.some(u => /computed/.test(u.reason) && u.startLine === 19), reasons.join("\n"));
});

test("airflow: a Python file without Airflow, or importing it without a DAG, is not a DAG", () => {
  const plain = extractDag(`import pandas as pd\n\ndef DAG(x):\n    return x\n\nDAG("not airflow")\n`);
  assert.equal(plain.detected, false);
  assert.match(plain.reason!, /No `airflow` import/);
  const hook = extractDag(`from airflow.hooks.base import BaseHook\n\nclass MyHook(BaseHook):\n    pass\n`);
  assert.equal(hook.detected, false);
  assert.match(hook.reason!, /defines no DAG/);
  const other = extractDag(`from airflowish import thing\nthing()\n`);
  assert.equal(other.detected, false);
});

test("airflow: text in strings, docstrings and comments is ignored", () => {
  const x = extractDag(`"""
Example:
    from airflow import DAG
    with DAG("doc_dag") as dag:
        a = BashOperator(task_id="in_docstring")
"""
# from airflow import DAG
# ghost = BashOperator(task_id="in_comment") ; ghost >> other
from airflow import DAG  # a comment with task_id="nope" >> x
from airflow.operators.bash import BashOperator

with DAG('strings_dag', schedule='@once') as dag:
    a = BashOperator(task_id='a', bash_command="echo 'b >> c' # not a comment")
    b = BashOperator(
        task_id="b",
        bash_command=r"""
        echo "a >> b"; task_id="fake"
        """,
    )
    a >> b  # c >> a
`);
  assert.deepEqual(x.dags.map(d => d.dagId), ["strings_dag"]);
  assert.deepEqual(ids(x), ["a", "b"]);
  assert.deepEqual(edges(x), ["a>b"]);
  assert.deepEqual(x.unresolved, []);
  assert.equal(task(x, "b").startLine, 14);
  assert.equal(task(x, "b").endLine, 19);
});

test("airflow: XCom arguments (.output, TaskFlow results) and dynamic task mapping", () => {
  const x = extractDag(`
from airflow import DAG
from airflow.decorators import task
from airflow.operators.python import PythonOperator
from airflow.providers.cncf.kubernetes.operators.pod import KubernetesPodOperator

with DAG("xcom_dag") as dag:
    produce = PythonOperator(task_id="produce", python_callable=len)
    consume = PythonOperator(task_id="consume", python_callable=len, op_args=[produce.output])

    @task
    def files():
        return ["a", "b"]

    @task
    def handle(name):
        return name

    handle.expand(name=files())
    pods = KubernetesPodOperator.partial(task_id="pods", image="x").expand(arguments=[["a"], ["b"]])
`);
  assert.deepEqual(edges(x), ["files>handle", "produce>consume"].sort());
  assert.equal(task(x, "handle").mapped, true);
  assert.equal(task(x, "pods").mapped, true);
  assert.equal(task(x, "pods").kind, "container");
});

test("airflow: several DAGs in one file keep their own tasks", () => {
  const x = extractDag(`
from airflow import DAG
from airflow.operators.empty import EmptyOperator
with DAG("one") as d1:
    EmptyOperator(task_id="a") >> EmptyOperator(task_id="b")
with DAG("two", schedule="@daily") as d2:
    c = EmptyOperator(task_id="c")
`);
  assert.deepEqual(x.dags.map(d => d.dagId), ["one", "two"]);
  assert.deepEqual(x.tasks.map(t => `${t.id}@${t.dag}`), ["a@0", "b@0", "c@1"]);
  assert.deepEqual(edges(x), ["a>b"]);
});

test("airflow: bounds — files over 512 KB are not read, at most 500 tasks are drawn", () => {
  const big = `from airflow import DAG\n# ${"x".repeat(AIRFLOW_LIMITS.maxBytes)}\n`;
  const r = extractDag(big);
  assert.equal(r.detected, false);
  assert.match(r.reason!, /512 KB/);
  const lines = ["from airflow import DAG", "from airflow.operators.empty import EmptyOperator", "with DAG('many') as dag:"];
  for (let i = 0; i < 520; i++) lines.push(`    t${i} = EmptyOperator(task_id="t${i}")`);
  const m = extractDag(lines.join("\n"));
  assert.equal(m.tasks.length, AIRFLOW_LIMITS.maxTasks);
  assert.equal(m.truncated, true);
  assert.ok(m.unresolved.some(u => /500 tasks/.test(u.reason)));
});

test("airflow: operator kinds", () => {
  assert.equal(kindOf("PythonOperator"), "python");
  assert.equal(kindOf("BashOperator"), "bash");
  assert.equal(kindOf("SparkSubmitOperator"), "spark");
  assert.equal(kindOf("DatabricksRunNowOperator"), "databricks");
  assert.equal(kindOf("SQLExecuteQueryOperator"), "sql");
  assert.equal(kindOf("BigQueryInsertJobOperator"), "sql");
  assert.equal(kindOf("S3KeySensor"), "sensor");
  assert.equal(kindOf("DockerOperator"), "container");
  assert.equal(kindOf("EmailOperator"), "notify");
  assert.equal(kindOf("TriggerDagRunOperator"), "trigger");
  assert.equal(kindOf("EmptyOperator"), "empty");
  assert.equal(kindOf("MyCustomOperator"), "other");
});

test("airflow: layered layout follows the longest path and survives a cycle", () => {
  const x = extractDag(readFileSync("tests/fixtures/airflow/etl_dag.py", "utf8"));
  const placed = new Map(layoutDag(x.tasks, x.edges).placed.map(p => [p.id, p]));
  assert.deepEqual(["wait_for_file", "extract", "transform_spark", "load_sql", "notify"].map(id => placed.get(id)!.layer), [0, 1, 2, 3, 4]);
  const t = (id: string) => ({ id, label: id, operator: "E", kind: "empty" as const, startLine: 1, endLine: 1, dag: 0 });
  const cyc = layoutDag([t("a"), t("b"), t("c"), t("d")], [{ from: "a", to: "b", line: 1 }, { from: "b", to: "c", line: 1 }, { from: "c", to: "b", line: 1 }, { from: "a", to: "d", line: 1 }]).placed;
  assert.equal(cyc.length, 4);
  assert.equal(new Set(cyc.map(p => p.id)).size, 4);
  const byId = new Map(cyc.map(p => [p.id, p.layer]));
  assert.equal(byId.get("a"), 0);
  assert.equal(byId.get("d"), 1);
  // A short side branch sits beside the task it feeds (no long edge across the layers between).
  const sideLayout = layoutDag([t("a"), t("b"), t("c"), t("x"), t("z")], [
    { from: "a", to: "b", line: 1 }, { from: "b", to: "c", line: 1 }, { from: "c", to: "z", line: 1 }, { from: "a", to: "x", line: 1 }, { from: "x", to: "z", line: 1 }
  ]);
  const side = new Map(sideLayout.placed.map(p => [p.id, p.layer]));
  assert.deepEqual(["a", "b", "c", "x", "z"].map(id => side.get(id)), [0, 1, 2, 2, 3]);
  // a → x skips layer 1: it passes through a slot there, beside b (never through b's box).
  const ax = sideLayout.routes.find(r => r.from === "a" && r.to === "x")!;
  assert.equal(ax.via.length, 1);
  assert.equal(ax.via[0]!.layer, 1);
  assert.equal(sideLayout.width.get(1), 2);
  assert.notEqual(ax.via[0]!.order, sideLayout.placed.find(p => p.id === "b")!.order);
});
