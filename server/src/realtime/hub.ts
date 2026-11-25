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

  // The transport can close before its close callback runs. Do not report an
  // already disconnected WebSocket as an online user or keep a dead socket.
  private openSockets(userId: string) {
    const set = this.byUser.get(userId);
    if (!set) return;
    for (const s of set) if (s.readyState !== 1) set.delete(s);
    if (!set.size) {
      this.byUser.delete(userId);
      return;
    }
    return set;
  }

  online(userId: string) {
    return !!this.openSockets(userId)?.size;
  }

  send(userIds: (string | null | undefined)[], event: Record<string, unknown>) {
    const json = JSON.stringify(event);
    for (const id of new Set(userIds.filter(Boolean) as string[])) {
      if (this.keepLog) this.log.push({ userId: id, event });
      for (const s of this.openSockets(id) ?? []) {
        try {
          s.send(json);
        } catch {
          // One disconnecting/broken socket must not prevent delivery to
          // other tabs, other users or the subsequent push notification.
          // A later close callback may still call remove() harmlessly.
          this.remove(id, s);
        }
      }
    }
  }
}
