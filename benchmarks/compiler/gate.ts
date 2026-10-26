// The compiler reads this gate at module initialization. Each variant needs a fresh page.
const enabled = new URLSearchParams(location.search).get('compiler') === 'on';
export function isCompilerEnabled() { return enabled; }
