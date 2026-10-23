import { parseRipgrepFiles, searchFiles } from '../src/happy/suggestions';

// Expose the production matcher to the browser probe without a product API.
Object.assign(window, { __raynoSearch: { parseRipgrepFiles, searchFiles } });
