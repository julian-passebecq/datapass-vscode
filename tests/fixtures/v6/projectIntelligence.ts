import type { DataPassProjectManifest } from '../../../src/core/projectManifestModel';

export const intelligenceManifest: DataPassProjectManifest = {
  schemaVersion: 5, project: { id: 'offline-intelligence', title: 'Offline intelligence', description: 'Static project understanding without provider access.' },
  environments: [{ id: 'sandbox-west', title: 'Sandbox West' }, { id: 'client-live', title: 'Client Live', production: true }],
  identifiers: [{ id: 'workspace', label: 'Workspace', provider: 'fabric', values: { 'sandbox-west': 'sandbox-fixture', 'client-live': 'live-fixture' } }],
  graph: '.datapass/graph.json', scopes: [{ id: 'orders', title: 'Order processing', objective: 'Explain the local flow', itemRefs: ['source', 'spark', 'report'] }]
};
export const intelligenceFiles: Record<string, string> = {
  '.datapass/project.json': JSON.stringify(intelligenceManifest, null, 2),
  '.datapass/graph.json': JSON.stringify({ format: 'datapass.graph', version: '0.2', items: [
    { id: 'source', kind: 'script', label: 'Order SQL', provider: 'python', artifacts: { profile: 'python.script', root: 'src', entry: 'query.sql', files: ['query.sql'] } },
    { id: 'spark', kind: 'notebook', label: 'Spark notebook', provider: 'fabric', artifacts: { profile: 'fabric.item', root: 'src', entry: 'spark.py', files: ['spark.py'] }, operations: [{ capability: 'fabric.workspace.deploy', environment: 'sandbox-west' }] },
    { id: 'report', kind: 'report', label: 'Order report', provider: 'powerbi', artifacts: { profile: 'powerbi.pbip', root: 'bi', entry: 'Orders.pbip', files: ['Orders.pbip', 'Orders.Report/definition.pbir'] } }
  ], relations: [{ id: 'source-spark', source: 'source', target: 'spark', relation: 'consumes' }] }),
  'src/query.sql': 'SELECT id, total FROM dbo.orders;\n',
  'src/spark.py': 'from pyspark.sql import SparkSession\ndf = spark.table("orders")\ndf.select("id").write.mode("overwrite").saveAsTable("clean_orders")\n',
  'src/spark_session.py': 'from pyspark.sql import SparkSession\nspark = SparkSession.builder.getOrCreate()\ndf = spark.table("orders")\ndf.select("id").write.mode("overwrite").saveAsTable("clean_orders")\n',
  'src/example.ipynb': JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'python3', language: 'python', display_name: 'Python' } }, cells: [{ cell_type: 'code', source: ['from pyspark.sql import SparkSession\n', 'df = spark.table("orders")\n'], execution_count: null, outputs: [], metadata: {} }] }),
  'api/openapi.json': JSON.stringify({ openapi: '3.0.3', info: { title: 'Orders', version: '1' }, paths: { '/orders': { get: { operationId: 'orders', responses: { '200': { description: 'ok' } } } } } }),
  'bundle/databricks.yml': 'bundle:\n  name: orders\nresources:\n  jobs:\n    orders:\n      tasks:\n        - task_key: transform\n          notebook_task:\n            notebook_path: ../src/example.ipynb\n',
  'dbt/dbt_project.yml': 'name: offline\nprofile: warehouse\nmodel-paths: [models]\n',
  'dbt/profiles.yml': 'warehouse:\n  target: local\n  outputs:\n    local:\n      type: sqlserver\n      database: fixture\n      schema: analytics\n',
  'dbt/models/source_orders.sql': "{{ config(materialized='view') }}\nSELECT id, total FROM raw.orders;\n",
  'dbt/models/clean_orders.sql': "SELECT id, total FROM {{ ref('source_orders') }};\n",
  'bi/Orders.pbip': JSON.stringify({ artifacts: [{ report: { path: 'Orders.Report' } }] }),
  'bi/Orders.Report/definition.pbir': JSON.stringify({ datasetReference: { byPath: { path: '../Orders.SemanticModel' } } }),
  'bi/Orders.Report/definition/report.json': '{}',
  'bi/Orders.SemanticModel/definition/tables/Orders.tmdl': 'table Orders\n\tcolumn id\n\t\tdataType: int64\n',
  'infra/main.tf': 'resource "azurerm_resource_group" "orders" { name = "orders" location = "West Europe" }\n',
  '.env': 'TEST_SECRET=never-read-or-export\n'
};
