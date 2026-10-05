// Adapted from datapass-vscode-hub git-service @ 7dcd191841304454050ed9c3d9b831a30aa688f5.
/** Path family only. Repository observations reuse DataPass GitRepoReport. */
export type ArtifactKind =
  | 'sql'
  | 'notebook'
  | 'python'
  | 'fabric-item'
  | 'databricks-bundle'
  | 'pipeline'
  | 'iac'
  | 'ci'
  | 'config'
  | 'docs'
  | 'other';
