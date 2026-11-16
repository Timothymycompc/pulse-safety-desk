// secrets.ts — loads secrets from Google Secret Manager at startup (same setup as every Pulse project).
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export async function loadSecrets(names: string[]): Promise<void> {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) { console.warn("GCP_PROJECT_ID not set; using environment variables only."); return; }
  const client = new SecretManagerServiceClient();
  for (const name of names) {
    if (process.env[name]) continue;
    try {
      const [version] = await client.accessSecretVersion({ name: `projects/${project}/secrets/${name}/versions/latest` });
      const value = version.payload?.data?.toString();
      if (value) { process.env[name] = value.trim(); console.log(`Loaded ${name} from Secret Manager`); }
    } catch (err) {
      console.warn(`Could not load ${name} from Secret Manager:`, (err as Error).message);
    }
  }
}
