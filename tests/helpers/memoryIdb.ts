/** Transactional IDB test backend: writes land only on complete, with injectable
 * aborts. It exercises the actual disk queue/index, not a second budget algorithm.
 */
export function memoryIdb() {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  const defaultStores = new Map<string, Map<string, unknown>>();
  dbs.set("openiptv", defaultStores);
  let activeStores = defaultStores;
  let active = 0;
  const control = {
    failNextWrite: false,
    hangOpen: false,
    hangTransactions: false,
    failAtPut: 0,
    puts: 0,
    failReadKey: "",
    blocked: false,
    maxWriters: 0,
    deleted: [] as string[],
    get stores() {
      return activeStores;
    },
    set stores(val: Map<string, Map<string, unknown>>) {
      activeStores = val;
    },
  };

  function createDatabase(name = "openiptv") {
    let stores = dbs.get(name);
    if (!stores) {
      stores = new Map<string, Map<string, unknown>>();
      dbs.set(name, stores);
    }
    activeStores = stores;
    const database = {
      objectStoreNames: { contains: (sName: string) => stores.has(sName) },
      createObjectStore(sName: string) {
        stores.set(sName, new Map());
      },
      close() {},
      onversionchange: null,
      transaction(_names: string[], mode: string) {
        let aborted = false;
        let abortOnCommit = false;
        const writes: (() => void)[] = [];
        const writer = mode === "readwrite";
        if (writer) control.maxWriters = Math.max(control.maxWriters, ++active);
        const tx = {
          oncomplete: null as (() => void) | null,
          onabort: null as (() => void) | null,
          onerror: null as (() => void) | null,
          abort() {
            if (aborted) return;
            aborted = true;
            if (writer) active--;
            tx.onabort?.();
          },
          objectStore(sName: string) {
            const values = stores.get(sName)!;
            const request = (value: unknown) => {
              const req = {
                result: value,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                fail: false,
              };
              setTimeout(() => {
                if (!aborted) {
                  if (req.fail) req.onerror?.();
                  else req.onsuccess?.();
                }
              }, 0);
              return req;
            };
            return {
              get: (key: string) => {
                const req = request(values.get(key));
                req.fail = key === control.failReadKey;
                return req;
              },
              getAllKeys: () => request([...values.keys()]),
              getAll: () =>
                request(
                  [...values.values()].map((v) =>
                    typeof v === "object" ? { ...(v as object) } : v,
                  ),
                ),
              put(value: unknown, key: string) {
                if (sName === "values") control.puts++;
                if (sName === "values" && control.failAtPut && control.puts === control.failAtPut)
                  abortOnCommit = true;
                writes.push(() => values.set(key, value));
                return request(key);
              },
              clear() {
                writes.push(() => values.clear());
                return request(undefined);
              },
              delete(key: string) {
                writes.push(() => values.delete(key));
                return request(undefined);
              },
            };
          },
        };
        setTimeout(() => {
          if (aborted || control.hangTransactions) return;
          if (abortOnCommit) {
            tx.abort();
            return;
          }
          if (writer && control.failNextWrite) {
            control.failNextWrite = false;
            tx.abort();
            return;
          }
          for (const write of writes) write();
          if (writer) active--;
          tx.oncomplete?.();
        }, 2);
        return tx;
      },
    };
    return database;
  }

  const factory = {
    open(name = "openiptv") {
      const database = createDatabase(name);
      const request = {
        result: database,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null,
        onblocked: null as (() => void) | null,
      };
      setTimeout(() => {
        if (control.hangOpen) return;
        if (control.blocked) {
          request.onblocked?.();
          return;
        }
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
    deleteDatabase(name: string) {
      const request = {
        onsuccess: null as (() => void) | null,
        onerror: null,
        onblocked: null,
      };
      dbs.delete(name);
      control.deleted.push(name);
      setTimeout(() => request.onsuccess?.(), 0);
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, control };
}
