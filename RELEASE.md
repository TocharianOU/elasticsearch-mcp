# Release Guide

## Creating a Full Release Package

This project supports creating **standalone release packages** that include all dependencies and can be used immediately after extraction.

### Quick Start

```bash
# Create a release package
npm run release
```

This will generate:
- `elasticsearch-mcp-vX.Y.Z.tar.gz` - The release package
- `elasticsearch-mcp-vX.Y.Z.tar.gz.sha256` - SHA256 checksum
- `elasticsearch-mcp-vX.Y.Z.tar.gz.sha512` - SHA512 checksum

### What's Included

The release package contains:
- ✅ Compiled code (`dist/`)
- ✅ All production dependencies (`node_modules/`)
- ✅ Logos and assets
- ✅ Documentation (`README.md`, `LICENSE`, `NOTICE.txt`)
- ✅ Configuration files (`package.json`, `server.json`)
- ✅ Checksum files (`*.sha256`, `*.sha512`) for integrity verification

### Verifying Package Integrity

Before extracting the package, verify its integrity using the provided checksums:

```bash
# Verify SHA256 checksum
shasum -a 256 -c elasticsearch-mcp-vX.Y.Z.tar.gz.sha256

# Verify SHA512 checksum
shasum -a 512 -c elasticsearch-mcp-vX.Y.Z.tar.gz.sha512
```

If the verification succeeds, you'll see:
```
elasticsearch-mcp-vX.Y.Z.tar.gz: OK
```

### Usage

#### 1. Extract the package

```bash
mkdir elasticsearch-mcp
cd elasticsearch-mcp
tar -xzf elasticsearch-mcp-vX.Y.Z.tar.gz
```

The directory structure will be flat:
```
elasticsearch-mcp/
├── dist/
│   └── index.js
├── node_modules/
├── logos/
├── package.json
├── server.json
├── README.md
├── LICENSE
└── NOTICE.txt
```

#### 2. Run directly (no installation needed)

```bash
# Run with environment variables
ES_URL=https://localhost:9200 ES_API_KEY=your-key node dist/index.js

# Or use it with MCP clients
# Add to your MCP client config:
{
  "elasticsearch": {
    "command": "node",
    "args": ["/path/to/elasticsearch-mcp/dist/index.js"],
    "env": {
      "ES_URL": "https://localhost:9200",
      "ES_API_KEY": "your-api-key"
    }
  }
}
```

### Testing the Release Package

```bash
# Test the release before distribution
npm run release

# Extract and test
mkdir test-release && cd test-release
tar -xzf ../elasticsearch-mcp-v*.tar.gz

# Verify it works
ES_URL=https://your-es-instance:9200 node dist/index.js
```

### Release Checklist

Before creating a release:

1. ✅ Update version in `package.json`
2. ✅ Update `CHANGELOG.md` (if exists)
3. ✅ Run tests: `npm test`
4. ✅ Build: `npm run build`
5. ✅ Create release package: `npm run release`
6. ✅ Test the package (extract and run)
7. ✅ Verify checksums are generated
8. ✅ Create git tag: `git tag vX.Y.Z`
9. ✅ Push tag: `git push origin vX.Y.Z`
10. ✅ Upload tarball and checksum files to GitHub release

### Alternative: NPM-only Package

If you want to create a package for npm registry (without node_modules):

```bash
npm run release:npm
```

This creates a lightweight package that users will install via `npm install`.

### Package Size Optimization

The release script automatically:
- Removes test files from dependencies
- Removes documentation files from node_modules
- Excludes optional dependencies
- Cleans up unnecessary metadata

Typical package size: ~50-100MB (depending on dependencies)

### Security Best Practices

**Always verify checksums before using release packages:**

1. **Download all files:**
   - `elasticsearch-mcp-vX.Y.Z.tar.gz`
   - `elasticsearch-mcp-vX.Y.Z.tar.gz.sha256`
   - `elasticsearch-mcp-vX.Y.Z.tar.gz.sha512`

2. **Verify integrity:**
   ```bash
   shasum -a 256 -c elasticsearch-mcp-vX.Y.Z.tar.gz.sha256
   ```

3. **Only proceed if verification succeeds**

This ensures:
- The package hasn't been corrupted during download
- The package hasn't been tampered with
- You're using the authentic release from the maintainer
