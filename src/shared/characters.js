/** Fixed, local character registry. IDs never become unchecked filesystem paths. */
const DEFAULT_CHARACTER_ID = 'blue-maid';
const CHARACTERS = Object.freeze([
  { id: 'blue-maid', name: '蓝鲸女仆', animationRoot: 'assets/animations' },
  { id: 'blonde-reaper', name: '金发战斧', animationRoot: 'assets/characters/blonde-reaper' },
  { id: 'orange-mage', name: '橙发花语', animationRoot: 'assets/characters/orange-mage' },
  { id: 'violet-cat', name: '紫发星猫', animationRoot: 'assets/characters/violet-cat' },
  { id: 'white-dragon', name: '白发龙姬', animationRoot: 'assets/characters/white-dragon' }
].map((character) => Object.freeze(character)));

function normalizeCharacterId(id) {
  return CHARACTERS.some((character) => character.id === id) ? id : DEFAULT_CHARACTER_ID;
}
function getCharacter(id) {
  return CHARACTERS.find((character) => character.id === normalizeCharacterId(id));
}
function listCharacters() { return CHARACTERS.map((character) => ({ ...character })); }

module.exports = { DEFAULT_CHARACTER_ID, CHARACTERS, normalizeCharacterId, getCharacter, listCharacters };
