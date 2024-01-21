import { Entity } from './entity';

export class MdDocId {
  constructor(
    readonly file: string,
    readonly nodeNo: number
  ) {}

  toString(): string {
    return `${this.file}:${this.nodeNo}`;
  }

  static fromString(text: string): MdDocId {
    const matches = text.match(/^(.*):(\d+)$/);
    if (!matches) {
      throw new Error(`Invalid MdDocId format: ${text}`);
    }
    return new MdDocId(matches[1], parseInt(matches[2]));
  }
}

export class MdDoc implements Entity<MdDocId> {
  constructor(
    readonly id: MdDocId,
    readonly type: 'heading' | 'paragraph',
    readonly en: string,
    readonly ja: string
  ) {}
}
