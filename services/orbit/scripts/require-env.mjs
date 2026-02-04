import fs from "node:fs";
import path from "node:path";

const required = ["ALLOWED_ORIGIN"];

function hasInWranglerToml(name) {
  const tomlPath = path.join(process.cwd(), "wrangler.toml");
  if (!fs.existsSync(tomlPath)) return false;
  const content = fs.readFileSync(tomlPath, "utf8");
  const lines = content.split(/\r?\n/);
  let inVars = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      inVars = line === "[vars]" || /^\[env\.[^.]+\.vars\]$/.test(line);
      continue;
    }
    if (!inVars) continue;
    if (line.startsWith(`${name} `) || line.startsWith(`${name}=`)) {
      return true;
    }
  }
  return false;
}

const missing = required.filter((name) => {
  if (process.env[name]) return false;
  return !hasInWranglerToml(name);
});

if (missing.length > 0) {
  console.error(`Missing required config: ${missing.join(", ")}.`);
  console.error("Set it via environment variables or in wrangler.toml under [vars] or [env.<name>.vars].");
  process.exit(1);
}
