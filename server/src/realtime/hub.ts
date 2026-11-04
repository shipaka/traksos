// Живые соединения (WebSocket): статусы заявок, чат, входящие вызовы.

export interface Socket {
  send(data: string): void;
  readyState: number;
}

export class Hub {
  private byUser = new Map<string, Set<Socket>>();
  /** Для тестов: всё, что отправлено */
  log: { userId: string; event: any }[] = [];
  keepLog = false;

  add(userId: string, s: Socket) {
    let set = this.byUser.get(userId);
    if (!set) this.byUser.set(userId, (set = new Set()));
    set.add(s);
  }

  remove(userId: string, s: Socket) {
    const set = this.byUser.get(userId);
    set?.delete(s);
    if (set && !set.size) this.byUser.delete(userId);
  }

  online(userId: string) {
    return this.byUser.has(userId);
  }

  send(userIds: (string | null | undefined)[], event: Record<string, unknown>) {
    const json = JSON.stringify(event);
    for (const id of new Set(userIds.filter(Boolean) as string[])) {
      if (this.keepLog) this.log.push({ userId: id, event });
      for (const s of this.byUser.get(id) ?? []) if (s.readyState === 1) s.send(json);
    }
  }
}
