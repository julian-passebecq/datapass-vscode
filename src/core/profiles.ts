export interface ProjectProfileDefinition {
  id: string;
  title: string;
  repoBindings: Array<{ id: string; label: string; setting: string; expectedFolder?: string }>;
  platformBindings: string[];
}

export function validateProjectProfile(profile: ProjectProfileDefinition): string[] {
  const issues: string[] = [];
  if (!profile.id.trim()) issues.push("Profile id is required.");
  if (!profile.title.trim()) issues.push("Profile title is required.");
  const bindingIds = new Set<string>();
  for (const binding of profile.repoBindings) {
    if (!binding.id.trim() || !binding.label.trim() || !binding.setting.trim()) {
      issues.push("Profile repo binding is incomplete.");
    }
    if (bindingIds.has(binding.id)) issues.push(`Duplicate repo binding: ${binding.id}`);
    bindingIds.add(binding.id);
  }
  return issues;
}
