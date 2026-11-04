// ESLint flat config. The core must stay pure (docs/decisions.md): no DOM, no clocks, no Math.random.
import js from '@eslint/js';
import globals from 'globals';

const NONDETERMINISM = [
    { object: 'Math', property: 'random', message: 'Use the injected random() (core/random.js).' },
    { object: 'Date', property: 'now', message: 'Core time comes from the fixed step.' },
    { object: 'performance', property: 'now', message: 'Core time comes from the fixed step.' }
];

export default [
    js.configs.recommended,
    {
        files: ['src/browser/**/*.js'],
        languageOptions: { globals: { ...globals.browser } }
    },
    {
        files: ['src/core/**/*.js'],
        languageOptions: { globals: {} },
        rules: {
            'no-restricted-properties': ['error', ...NONDETERMINISM],
            'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'navigator', 'requestAnimationFrame', 'setTimeout', 'setInterval']
        }
    },
    {
        files: ['tests/**/*.js', 'tests/**/*.mjs', '*.config.js'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } }
    }
];
