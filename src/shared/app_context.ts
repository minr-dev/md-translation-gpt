export class AppContext {
  private static globalCtx: AppContext;
  private values: Record<string, any> = {};

  documentName = '__unknown__';
  quoteOriginal = true;

  file = '__unknown__';
  nodeNo = 1;

  constructor() {
    AppContext.globalCtx = this;
  }

  get(key: string): any {
    return this.values[key];
  }

  set(key: string, value: any): void {
    this.values[key] = value;
  }

  static init(): AppContext {
    return new AppContext();
  }

  static getCurrent(): AppContext {
    if (!AppContext.globalCtx) {
      throw new Error('Global context is not registered yet.');
    }
    return AppContext.globalCtx;
  }
}
