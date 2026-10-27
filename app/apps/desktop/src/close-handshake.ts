/** One native close request waits for the renderer's async save/discard decision. */
export class CloseHandshake {
  #pending?: {
    id: string;
    resolve: (allowed: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  #sequence = 0;
  request(send: (id: string) => void): Promise<boolean> {
    if (this.#pending) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = String(++this.#sequence);
      const timer = setTimeout(() => this.respond(id, false), 30_000);
      this.#pending = { id, resolve, timer };
      try {
        send(id);
      } catch {
        this.respond(id, false);
      }
    });
  }
  respond(id: string, allowed: boolean): void {
    const pending = this.#pending;
    if (!pending || pending.id !== id) return;
    clearTimeout(pending.timer);
    this.#pending = undefined;
    pending.resolve(allowed);
  }
  cancel(): void {
    if (this.#pending) this.respond(this.#pending.id, false);
  }
}
