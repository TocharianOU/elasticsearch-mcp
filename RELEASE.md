# Release Guide

## Creating a Full Release Package

This project supports creating **standalone release packages** that include all dependencies and can be used immediately after extraction.

### Quick Start

```bash
# Create a release package
npm run release
```

This will generate a tarball: `elasticsearch-mcp-vX.Y.Z.tar.gz`

### What's Included

The release package contains:
- ✅ Compiled code (`dist/`)
- ✅ All production dependencies (`node_modules/`)
- ✅ Logos and assets
- ✅ Documentation (`README.md`, `LICENSE`, `NOTICE.txt`)
- ✅ Configuration files (`package.json`, `server.json`)

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
7. ✅ Create git tag: `git tag vX.Y.Z`
8. ✅ Push tag: `git push origin vX.Y.Z`
9. ✅ Upload tarball to GitHub release

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
