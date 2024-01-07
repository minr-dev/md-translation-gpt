import { Entity } from './entity';

export class MdHash implements Entity<string> {
  constructor(
    readonly file: string,
    readonly hash: string
  ) {}

  get id(): string {
    return this.file;
  }

  renewHash(hash: string): MdHash {
    return new MdHash(this.file, hash);
  }
}
