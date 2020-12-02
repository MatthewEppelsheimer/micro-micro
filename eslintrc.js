module.exports = {
	extends: ['erb', 'plugin:prettier'],
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: 'module',
		project: './tsconfig.json',
		tsconfigRootDir: __dirname,
		createDefaultProgram: true,
	},
	settings: {
		'import/parsers': {
			'@typescript-eslint/parser': ['.ts', '.tsx'],
		},
	},
};
