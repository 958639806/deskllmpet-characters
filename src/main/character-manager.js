const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { getPetConfig, setPetConfig, getAnimationConfig } = require('../shared/store');
const { getCharacter, listCharacters } = require('../shared/characters');
const listeners = new Set();

function scanCharacterAnimations(id = getPetConfig().characterId) {
  const character = getCharacter(id);
  const projectRoot = path.join(__dirname, '..', '..');
  const result = { characterId: character.id, idle: [], click: [] };
  for (const type of ['idle', 'click']) {
    const directory = path.join(projectRoot, character.animationRoot, type);
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter((file) => file.toLowerCase().endsWith('.webm')).sort()) {
      result[type].push({ name, path: `${character.animationRoot}/${type}/${name}` });
    }
  }
  return result;
}

function getCharacterState() {
  const pet = getPetConfig();
  return {
    character: { ...getCharacter(pet.characterId) }, pet,
    animations: getAnimationConfig(pet.characterId),
    availableAnimations: scanCharacterAnimations(pet.characterId)
  };
}

function broadcastCharacterChanged() {
  const snapshot = getCharacterState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('character-changed', snapshot);
  }
  for (const listener of listeners) listener(snapshot);
  return snapshot;
}

function selectCharacter(id) {
  setPetConfig({ characterId: getCharacter(id).id });
  return { success: true, ...broadcastCharacterChanged() };
}

function onCharacterChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); }

module.exports = { listCharacters, scanCharacterAnimations, getCharacterState, selectCharacter, broadcastCharacterChanged, onCharacterChanged };
