export const messageError = (error: unknown) =>
  error instanceof Error ? error.message : 'The request failed. Try again.';
// The daemon answers spawn-happy-session with requestToApproveDirectoryCreation for a missing folder.
export class DirectoryApprovalError extends Error {
  constructor(readonly directory: string) {
    super(`The folder ${directory} does not exist on this computer.`);
    this.name = 'DirectoryApprovalError';
  }
}
