import path from 'path';
import fs from 'fs';
import { Config } from '../../shared/config.js';
import { Entity } from '../../domain/entity.js';

export interface IEntityFactory<T> {
  create(data: Record<string, string>): T;
}

export class JsonClient<T extends Entity<string>> {
  private _rows: Map<string, T> | undefined;
  private jsonPath: string;

  constructor(
    readonly jsonFile: string,
    private factory: IEntityFactory<T>
  ) {
    this.jsonPath = path.join(Config.JSON_DIR, jsonFile);
  }

  async rows(): Promise<Map<string, T>> {
    return await this.loadSession();
  }

  async save(data: T): Promise<T> {
    await this.loadSession();
    this.putSession(data);
    if (!this._rows) {
      throw new Error('session is not loaded');
    }
    const values = Array.from(this._rows.values());
    const text = JSON.stringify(values, null, 2);

    if (!fs.existsSync(this.jsonPath)) {
      const dir = path.dirname(this.jsonPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    fs.writeFileSync(this.jsonPath, text);

    return data;
  }

  private putSession(data: T): void {
    if (!this._rows) {
      throw new Error('session is not loaded');
    }
    this._rows.set(data.id, data);
  }

  private async loadSession(): Promise<Map<string, T>> {
    if (this._rows) {
      return Promise.resolve(this._rows);
    }
    this._rows = new Map<string, T>();
    if (fs.existsSync(this.jsonPath)) {
      const text = fs.readFileSync(this.jsonPath, 'utf-8');
      if (text && text.length > 0) {
        const data = JSON.parse(text);
        for (const obj of data) {
          const entity = this.factory.create(obj as Record<string, string>);
          this.putSession(entity);
        }
      }
    }
    return Promise.resolve(this._rows);
  }
}
