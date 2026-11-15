import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// Determine version from environment or package.json
let version = pkg.version;
const tagRef = process.env.CI_TAG_REF || process.env.CI_REF_NAME || '';
const tagMatch = tagRef.match(/v?(\d+\.\d+(?:\.\d+)?)/);
if (tagMatch) {
  version = tagMatch[1];
}

// Server & repository configuration
const serverUrl = (process.env.CI_SERVER_URL || process.env.GITEA_URL || 'https://git.halvmj.uk').replace(/\/$/, '');
const repository = process.env.CI_REPOSITORY || 'dany/zappatv';

// Token lookup
let token = process.env.RELEASE_TOKEN || process.env.GITEA_TOKEN || process.env.CI_TOKEN;
if (!token && existsSync(join(ROOT, 'docs', '.env'))) {
  const envContent = readFileSync(join(ROOT, 'docs', '.env'), 'utf8');
  const tokenMatch = envContent.match(/GITEA_TOKEN=([a-f0-9]+)/);
  if (tokenMatch) token = tokenMatch[1];
}

if (!token) {
  console.error('No Gitea release token provided in RELEASE_TOKEN, GITEA_TOKEN or docs/.env');
  process.exit(1);
}

// Read release notes from CHANGELOG.md
let releaseNotes = '';
try {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const escaped = String(version).replaceAll('.', '\\.');
  const match = changelog.match(
    new RegExp(`^## \\[(?:${escaped})\\][^\n]*\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm')
  );
  if (match) {
    releaseNotes = match[1].trim();
  } else {
    // Fallback: take section after version header
    const parts = changelog.split(new RegExp(`## \\[?${escaped}\\]?`));
    if (parts.length > 1) {
      releaseNotes = parts[1].split(/## \[?\d/)[0].trim();
    }
  }
} catch (err) {
  console.warn(`Could not read changelog notes for version ${version}: ${err.message}`);
}

const body = `# Zappa TV v${version}

${releaseNotes}

---
**Installation Note**: Packages are unsigned for **Apps2Samsung** automatic signing.
- **Priority Targets**: Tizen 5.0 and 5.5
- **Experimental Targets**: Tizen 3.0 and 4.0
`;

console.log(`Starting publication for Zappa TV v${version} on ${serverUrl}/${repository}...`);

// 1. Check or create release
const releasesApi = `${serverUrl}/api/v1/repos/${repository}/releases`;
let release;

const getExisting = await fetch(`${releasesApi}/tags/v${version}`, {
  headers: { Authorization: `token ${token}` },
});

if (getExisting.ok) {
  release = await getExisting.json();
  console.log(`Found existing release v${version} (ID: ${release.id})`);
} else {
  console.log(`Creating release for tag v${version}...`);
  const createRes = await fetch(releasesApi, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tag_name: `v${version}`,
      name: `Zappa TV v${version}`,
      body: body,
      draft: false,
      prerelease: false,
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error(`Failed to create release: ${createRes.status} ${errText}`);
    process.exit(1);
  }

  release = await createRes.json();
  console.log(`Release created successfully: ID ${release.id}, URL: ${release.html_url}`);
}

// 2. Locate built assets in build/
const buildDir = join(ROOT, 'build');
if (!existsSync(buildDir)) {
  console.error(`Build directory not found at ${buildDir}`);
  process.exit(1);
}

// Check existing assets on release
const assetsRes = await fetch(`${releasesApi}/${release.id}/assets`, {
  headers: { Authorization: `token ${token}` },
});
const existingAssets = assetsRes.ok ? await assetsRes.json() : [];
const existingAssetNames = new Set(existingAssets.map((a) => a.name));

const files = readdirSync(buildDir).filter(
  (f) =>
    (f.startsWith(`zappa-${version}`) || f.startsWith(`zappa-`)) &&
    (f.endsWith('.wgt') || f.endsWith('.wgt.sha256')) &&
    f.includes(version)
);

console.log(`Found ${files.length} release asset candidates in build/ for version ${version}:`, files);

for (const name of files) {
  if (existingAssetNames.has(name)) {
    console.log(`Asset ${name} is already attached to release. Skipping.`);
    continue;
  }

  const filePath = join(buildDir, name);
  const fileBytes = readFileSync(filePath);
  const formData = new FormData();
  formData.append('attachment', new Blob([fileBytes]), name);

  console.log(`Uploading asset ${name} (${fileBytes.length} bytes)...`);
  const uploadRes = await fetch(
    `${releasesApi}/${release.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
      },
      body: formData,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error(`Failed to upload ${name}: ${uploadRes.status} ${err}`);
  } else {
    console.log(`Uploaded ${name} successfully.`);
  }
}

console.log(`Release v${version} publication complete on Gitea: ${release.html_url}`);
