"""Regenerates erd-sql-facts.json with the pinned SQLGlot (30.19.0), same dump as analysis-host-node."""
import hashlib, json, pathlib, sqlglot

SQL = """CREATE TABLE dbo.customer (id INT NOT NULL PRIMARY KEY, name NVARCHAR(100), region_id INT);
CREATE TABLE dbo.region (region_id INT NOT NULL, label VARCHAR(50), CONSTRAINT pk_region PRIMARY KEY (region_id));
CREATE TABLE dbo.orders (order_id INT PRIMARY KEY, customer_id INT REFERENCES dbo.customer (id), amount DECIMAL(10, 2), CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES dbo.customer (id));
ALTER TABLE dbo.customer ADD CONSTRAINT fk_region FOREIGN KEY (region_id) REFERENCES dbo.region (region_id);
SELECT o.order_id, c.name FROM dbo.orders o JOIN dbo.customer c ON o.customer_id = c.id JOIN dbo.payment p ON p.order_ref = o.order_id;
"""
here = pathlib.Path(__file__).parent
data = SQL.encode("utf-8")
statements = [{"tree": s.dump()} for s in sqlglot.parse(SQL, read="tsql") if s is not None]
facts = {"schema": "datapass.sql-syntax-facts/1", "artifactId": "sql:erd-fixture", "kind": "sqlglot", "dialect": "tsql",
         "parserVersion": sqlglot.__version__, "integrityDigest": {"algorithm": "sha256", "mode": "exact-bytes", "value": hashlib.sha256(data).hexdigest()},
         "statements": statements}
(here / "erd-sql-facts.json").write_text(json.dumps(facts, separators=(",", ":")), encoding="utf-8")
