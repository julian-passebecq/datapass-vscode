// Harbourlight Energy Analytics (fictional): the data platform's Azure resources, declarations only.
// Check with `az deployment group what-if`; deploying stays a person's action with the official CLI.
targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param environment string = 'dev'
param location string = resourceGroup().location
param tags object = {
  project: 'etl-demo'
  environment: environment
}

var suffix = 'hlenergy${environment}'

// Data lake: landing (vendor drops), raw (copied by Data Factory), and the Delta tables.
resource lake 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${suffix}'
  location: location
  tags: tags
  sku: { name: environment == 'prod' ? 'Standard_ZRS' : 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    isHnsEnabled: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: lake
  name: 'default'
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for name in ['landing', 'raw', 'lakehouse']: {
  parent: blobs
  name: name
  properties: { publicAccess: 'None' }
}]

// Databricks workspace that runs the two Spark jobs and the SQL warehouse.
resource databricks 'Microsoft.Databricks/workspaces@2024-05-01' = {
  name: 'dbw-${suffix}'
  location: location
  tags: tags
  sku: { name: 'premium' }
  properties: {
    managedResourceGroupId: subscriptionResourceId('Microsoft.Resources/resourceGroups', 'rg-dbw-${suffix}-managed')
  }
}

// Data Factory: copies the vendor's drop from landing to raw as parquet (pipeline pl_copy_meter_drop).
resource factory 'Microsoft.DataFactory/factories@2018-06-01' = {
  name: 'adf-${suffix}'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: { publicNetworkAccess: 'Enabled' }
}

// The factory reads and writes the lake with its own identity (Storage Blob Data Contributor).
resource factoryOnLake 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(lake.id, factory.id, 'blob-data-contributor')
  scope: lake
  properties: {
    principalId: factory.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

output lakeName string = lake.name
output databricksUrl string = 'https://${databricks.properties.workspaceUrl}'
output factoryName string = factory.name
