import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      // eslint-plugin-react-hooks v5 nabízí flat config pod klíčem
      // 'recommended-latest'; `configs.flat` je až z v6 a bez něj celý config
      // spadl na „Cannot read properties of undefined".
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      // Bez `jsx-uses-vars` nevidí `no-unused-vars` použití komponenty v JSX:
      // `<Icon />` neplatilo jako čtení proměnné, takže destrukturovaná
      // komponenta padala jako nepoužitá. Zbytek pravidel pluginu záměrně
      // nezapínáme — jde jen o to, aby lint o JSX věděl pravdu.
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': 'error',
      // Hlídá jen hot reload ve vývoji, ne správnost běhu. Splnit ho by
      // znamenalo rozdělovat soubory (context + provider apod.) — cena vyšší
      // než užitek, tak ať je vidět, ale neblokuje.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
