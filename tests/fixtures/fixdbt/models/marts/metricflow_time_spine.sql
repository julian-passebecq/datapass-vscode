-- SYNTHETIC FIXTURE: MetricFlow day time spine (never executed).
select explode(sequence(date'2026-01-01', date'2026-12-31', interval 1 day)) as date_day
