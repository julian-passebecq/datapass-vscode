"""Variant B (some files present): an Azure Function triggered by each new blob. host.json is still missing."""
import azure.functions as func

app = func.FunctionApp()
