declare module "@kbco/pcpartpicker" {
  export type PartPickerRow = Record<string, unknown>;
  export function search(type: string, query: string, page?: number): Promise<PartPickerRow[]>;
  export function query(url: string, partMapping: Record<number, string>, page?: number): Promise<PartPickerRow[]>;
  const _default: {
    search: typeof search;
    query: typeof query;
  };
  export default _default;
}
