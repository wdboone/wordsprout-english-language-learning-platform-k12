'use strict';
// A minimal, in-memory stand-in for @supabase/supabase-js's query builder.
// It supports exactly the surface WordSprout's index.html actually calls
// (.select/.eq/.order/.single/.maybeSingle/.insert/.update/.delete, plus
// storage.from().upload()/createSignedUrl(), plus a tiny auth shim) so the
// real app code can run unmodified against seeded fixture data.

function matches(row, filters) {
  return filters.every(([col, val]) => row[col] === val);
}

class QueryBuilder {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this._filters = [];
    this._order = null;
    this._mode = 'select';
    this._payload = null;
    this._single = null; // 'single' | 'maybeSingle' | null
  }
  select() { if(this._mode === 'select' || !this._mode) this._mode = 'select'; this._returning = true; return this; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  order(col, opts) { this._order = { col, asc: !opts || opts.ascending !== false }; return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = 'single'; return this; }
  maybeSingle() { this._single = 'maybeSingle'; return this; }
  insert(payload) { this._mode = 'insert'; this._payload = payload; return this; }
  update(payload) { this._mode = 'update'; this._payload = payload; return this; }
  delete() { this._mode = 'delete'; return this; }

  _rows() {
    const table = this.db[this.table] || (this.db[this.table] = []);
    return table.filter((r) => matches(r, this._filters));
  }

  then(resolve, reject) {
    try {
      const table = this.db[this.table] || (this.db[this.table] = []);
      let data, error = null;
      if (this._mode === 'select') {
        let rows = this._rows();
        if (this._order) {
          rows = [...rows].sort((a, b) => {
            const av = a[this._order.col], bv = b[this._order.col];
            return this._order.asc ? (av > bv ? 1 : av < bv ? -1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
          });
        }
        if (this._limit != null) rows = rows.slice(0, this._limit);
        if (this._single === 'single') data = rows[0] || null;
        else if (this._single === 'maybeSingle') data = rows[0] || null;
        else data = rows;
      } else if (this._mode === 'insert') {
        const items = Array.isArray(this._payload) ? this._payload : [this._payload];
        const inserted = items.map((item) => {
          const row = { id: this.db._nextId(this.table), created_at: new Date().toISOString(), ...item };
          table.push(row);
          return row;
        });
        data = this._single ? inserted[0] : inserted;
      } else if (this._mode === 'update') {
        const rows = this._rows();
        rows.forEach((r) => Object.assign(r, this._payload));
        data = rows;
      } else if (this._mode === 'delete') {
        const rows = this._rows();
        rows.forEach((r) => {
          const idx = table.indexOf(r);
          if (idx !== -1) table.splice(idx, 1);
        });
        data = rows;
      }
      resolve({ data, error });
    } catch (e) {
      resolve({ data: null, error: { message: e.message } });
    }
    return Promise.resolve();
  }
  catch(fn) { return this.then((v) => v).catch ? Promise.resolve(this).catch(fn) : this; }
}

function makeFakeSupabase(fixtures) {
  const db = { ...fixtures };
  db._ids = {};
  db._nextId = (table) => {
    db._ids[table] = (db._ids[table] || 0) + 1;
    return db._ids[table];
  };

  let currentSession = null;
  const authListeners = [];

  const auth = {
    getSession: async () => ({ data: { session: currentSession }, error: null }),
    onAuthStateChange: (cb) => { authListeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; },
    signInWithPassword: async ({ email }) => {
      const user = db._users.find((u) => u.email === email);
      if (!user) return { data: null, error: { message: 'Invalid login credentials' } };
      currentSession = { user, access_token: 'fake-token-' + user.id };
      return { data: { session: currentSession }, error: null };
    },
    signOut: async () => { currentSession = null; return { error: null }; },
    resetPasswordForEmail: async () => ({ error: null }),
    updateUser: async () => ({ error: null }),
    _setSession(session) { currentSession = session; },
  };

  const storage = {
    from: () => ({
      upload: async () => ({ data: { path: 'fake/path' }, error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://example.com/fake-signed-url' }, error: null }),
    }),
  };

  return {
    from: (table) => new QueryBuilder(db, table),
    auth,
    storage,
    _db: db,
  };
}

module.exports = { makeFakeSupabase };
