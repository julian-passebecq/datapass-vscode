# Open a client project

A client project is one **bridge repository** (it holds `.datapass/project.json`) plus the client's own repositories.

1. Copy the bridge's address from its host (GitHub, Azure DevOps or GitLab — the **Clone** button, https or SSH).
2. Run **DataPass: Open a Client Project…** and paste it.
3. Choose the folder that holds this client's repositories.

DataPass clones the bridge, lists the repositories it declares with their role, clones the missing ones (you tick which), finds the ones already on this computer — whatever their folder name — and opens one window for the client.

Planned repositories are never cloned. Git signs in with your usual credential helper; DataPass never sees your credentials. Running the command again clones nothing new.
