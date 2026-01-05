#!/bin/bash
# Setup script to create symlinks to the 6 core Obsidian projects
# Run this from anywhere: ./scripts/setup-ref-links.sh

# Change to project root (parent of scripts folder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Check Node.js version (requires v16+)
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed or not in PATH"
    echo "Please install Node.js v16+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "ERROR: Node.js v16+ is required (found v$NODE_VERSION)"
    echo "Please upgrade Node.js from https://nodejs.org/"
    exit 1
fi

echo "Setting up symlinks to core Obsidian projects..."

# Central .ref location (one level up from project)
CENTRAL_REF_ROOT="../.ref"
CENTRAL_REF="../.ref/obsidian-dev"

# Create central .ref root if it doesn't exist
if [ ! -d "$CENTRAL_REF_ROOT" ]; then
    mkdir -p "$CENTRAL_REF_ROOT"
    echo "Created central .ref directory"
fi

# Create obsidian-dev subfolder if it doesn't exist
if [ ! -d "$CENTRAL_REF" ]; then
    mkdir -p "$CENTRAL_REF"
    echo "Created obsidian-dev subfolder"
fi

# Ensure plugins and themes folders exist
mkdir -p "$CENTRAL_REF/plugins"
mkdir -p "$CENTRAL_REF/themes"

# Check if git is available
if ! command -v git &> /dev/null; then
    echo "ERROR: git is not installed or not in PATH"
    echo "Please install git from https://git-scm.com/"
    exit 1
fi

# Clone the 6 core repos if they don't exist, or pull latest if they do
if [ ! -d "$CENTRAL_REF/obsidian-api" ]; then
    echo "Cloning obsidian-api..."
    if ! (cd "$CENTRAL_REF" && git clone https://github.com/obsidianmd/obsidian-api.git obsidian-api); then
        echo "ERROR: Failed to clone obsidian-api"
        echo "Check your internet connection and try again"
        exit 1
    fi
else
    echo "Updating obsidian-api..."
    (cd "$CENTRAL_REF/obsidian-api" && git pull) || echo "WARNING: Failed to update obsidian-api (continuing anyway)"
fi

if [ ! -d "$CENTRAL_REF/obsidian-sample-plugin" ]; then
    echo "Cloning obsidian-sample-plugin..."
    if ! (cd "$CENTRAL_REF" && git clone https://github.com/obsidianmd/obsidian-sample-plugin.git obsidian-sample-plugin); then
        echo "ERROR: Failed to clone obsidian-sample-plugin"
        echo "Check your internet connection and try again"
        exit 1
    fi
else
    echo "Updating obsidian-sample-plugin..."
    (cd "$CENTRAL_REF/obsidian-sample-plugin" && git pull) || echo "WARNING: Failed to update obsidian-sample-plugin (continuing anyway)"
fi

if [ ! -d "$CENTRAL_REF/obsidian-developer-docs" ]; then
    echo "Cloning obsidian-developer-docs..."
    if ! (cd "$CENTRAL_REF" && git clone https://github.com/obsidianmd/obsidian-developer-docs.git obsidian-developer-docs); then
        echo "ERROR: Failed to clone obsidian-developer-docs"
        echo "Check your internet connection and try again"
        exit 1
    fi
else
    echo "Updating obsidian-developer-docs..."
    (cd "$CENTRAL_REF/obsidian-developer-docs" && git pull) || echo "WARNING: Failed to update obsidian-developer-docs (continuing anyway)"
fi

if [ ! -d "$CENTRAL_REF/obsidian-plugin-docs" ]; then
    echo "Cloning obsidian-plugin-docs..."
    if ! (cd "$CENTRAL_REF" && git clone https://github.com/obsidianmd/obsidian-plugin-docs.git obsidian-plugin-docs); then
        echo "ERROR: Failed to clone obsidian-plugin-docs"
        echo "Check your internet connection and try again"
        exit 1
    fi
else
    echo "Updating obsidian-plugin-docs..."
    (cd "$CENTRAL_REF/obsidian-plugin-docs" && git pull) || echo "WARNING: Failed to update obsidian-plugin-docs (continuing anyway)"
fi

if [ ! -d "$CENTRAL_REF/obsidian-sample-theme" ]; then
    echo "Cloning obsidian-sample-theme..."
    if ! (cd "$CENTRAL_REF" && git clone https://github.com/obsidianmd/obsidian-sample-theme.git obsidian-sample-theme); then
        echo "ERROR: Failed to clone obsidian-sample-theme"
        echo "Check your internet connection and try again"
        exit 1
    fi
else
    echo "Updating obsidian-sample-theme..."
    (cd "$CENTRAL_REF/obsidian-sample-theme" && git pull) || echo "WARNING: Failed to update obsidian-sample-theme (continuing anyway)"
fi

if [ ! -d "$CENTRAL_REF/eslint-plugin" ]; then
    echo "Cloning eslint-plugin..."
    if ! (cd "$CENTRAL_REF" && git clone https://github.com/obsidianmd/eslint-plugin.git eslint-plugin); then
        echo "ERROR: Failed to clone eslint-plugin"
        echo "Check your internet connection and try again"
        exit 1
    fi
else
    echo "Updating eslint-plugin..."
    (cd "$CENTRAL_REF/eslint-plugin" && git pull) || echo "WARNING: Failed to update eslint-plugin (continuing anyway)"
fi

# Ensure project .ref directory exists
mkdir -p .ref

# Define the 6 core projects
CORE_PROJECTS=(
    "obsidian-api"
    "obsidian-sample-plugin"
    "obsidian-developer-docs"
    "obsidian-plugin-docs"
    "obsidian-sample-theme"
    "eslint-plugin"
)

# Create symlinks for each core project
for project in "${CORE_PROJECTS[@]}"; do
    link_path=".ref/$project"
    target_path="$CENTRAL_REF/$project"
    
    # Check if target exists
    if [ ! -d "$target_path" ]; then
        echo "WARNING: Target not found: $target_path"
        echo "  Skipping $project"
        continue
    fi
    
    # Remove existing link if it exists
    if [ -L "$link_path" ] || [ -d "$link_path" ]; then
        rm -rf "$link_path"
    fi
    
    # Create symlink
    ln -s "$target_path" "$link_path"
    if [ $? -eq 0 ]; then
        echo "✓ Created symlink: $link_path -> $target_path"
    else
        echo "ERROR: Failed to create symlink for $project"
    fi
done

echo ""
echo "Setup complete!"
echo ""
echo "Verifying symlinks..."

# Verify symlinks
for project in "${CORE_PROJECTS[@]}"; do
    link_path=".ref/$project"
    if [ -L "$link_path" ]; then
        echo "✓ $project : Symlink"
    elif [ -d "$link_path" ]; then
        echo "✗ $project : Regular directory (not a symlink)"
    else
        echo "✗ $project : Missing"
    fi
done

