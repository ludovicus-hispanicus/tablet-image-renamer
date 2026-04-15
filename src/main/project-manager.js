/**
 * Project manager for the renamer — reads/writes the same project files
 * as the stitcher (AppData/eBLImageProcessor/projects/).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DATA_DIR = 'eBLImageProcessor';
const PROJECTS_SUBDIR = 'projects';

function getUserProjectsDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
  const dir = path.join(appData, APP_DATA_DIR, PROJECTS_SUBDIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getBuiltinProjectsDir(stitcherExePath) {
  if (!stitcherExePath) return null;
  // Built-in projects are in assets/projects/ next to the stitcher exe
  const stitcherDir = path.dirname(stitcherExePath);
  // For PyInstaller one-file: assets are extracted to a temp dir at runtime,
  // but the built-in projects are also in the assets/ folder next to the exe
  const candidates = [
    path.join(stitcherDir, 'assets', 'projects'),
    path.join(stitcherDir, '..', 'assets', 'projects'), // macOS .app bundle
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function loadProjectFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data && data.name) return data;
  } catch (e) {
    console.error(`Error loading project ${filePath}: ${e.message}`);
  }
  return null;
}

/**
 * List all projects: built-in (from stitcher) + user overrides.
 * User projects with the same name override built-ins.
 */
function listProjects(stitcherExePath) {
  const builtinProjects = {};
  const userProjects = {};

  // Load built-in projects (from stitcher assets)
  const builtinDir = getBuiltinProjectsDir(stitcherExePath);
  if (builtinDir && fs.existsSync(builtinDir)) {
    for (const file of fs.readdirSync(builtinDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const data = loadProjectFile(path.join(builtinDir, file));
      if (data) {
        data.builtin = true;
        builtinProjects[data.name] = data;
      }
    }
  }

  // Load user projects (override built-ins)
  const userDir = getUserProjectsDir();
  if (fs.existsSync(userDir)) {
    for (const file of fs.readdirSync(userDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const data = loadProjectFile(path.join(userDir, file));
      if (data) {
        data.builtin = false;
        userProjects[data.name] = data;
      }
    }
  }

  // Merge: user overrides built-in
  const merged = {};
  for (const [name, project] of Object.entries(builtinProjects)) {
    merged[name] = userProjects[name] || project;
    delete userProjects[name];
  }
  for (const [name, project] of Object.entries(userProjects)) {
    merged[name] = project;
  }

  return Object.values(merged);
}

function getProjectByName(name, stitcherExePath) {
  const projects = listProjects(stitcherExePath);
  return projects.find(p => p.name === name) || null;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function saveUserProject(project) {
  const userDir = getUserProjectsDir();
  const filename = slugify(project.name) + '.json';
  const filePath = path.join(userDir, filename);
  project.builtin = false;
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
  return filePath;
}

function deleteUserProject(name) {
  const userDir = getUserProjectsDir();
  for (const file of fs.readdirSync(userDir)) {
    if (!file.endsWith('.json')) continue;
    const data = loadProjectFile(path.join(userDir, file));
    if (data && data.name === name) {
      fs.unlinkSync(path.join(userDir, file));
      return true;
    }
  }
  return false;
}

function defaultNewProject(name) {
  return {
    name: name || 'New Project',
    builtin: false,
    background_color: [255, 255, 255],
    ruler_mode: 'single',
    ruler_file: '',
    ruler_size_cm: 5.0,
    detection_method: 'general',
    ruler_position_locked: false,
    fixed_ruler_position: 'top',
    photographer: '',
    institution: '',
    credit_line: '',
    logo_enabled: false,
    logo_path: '',
    measurements_file: '',
  };
}

module.exports = {
  listProjects,
  getProjectByName,
  saveUserProject,
  deleteUserProject,
  defaultNewProject,
  getUserProjectsDir,
};
