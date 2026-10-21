export const messageError = (error: unknown) =>
  error instanceof Error ? error.message : 'The request failed. Try again.';
