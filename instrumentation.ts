// Starts the background poller as soon as the server boots,
// so the board is already filled when the first person opens the link.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { engine } = await import('./lib/engine');
    engine();
  }
}
