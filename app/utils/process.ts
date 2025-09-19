// This file is no longer needed as E2B handles process execution differently
// Keeping file structure for potential future use
export async function streamOutput() {
  console.warn('streamOutput is deprecated - use executeCommand from ~/lib/e2b instead');
  return { output: '', exitCode: 0 };
}
