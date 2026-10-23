// jsonld.js ships no type declarations; the conformance test uses only expand().
declare module "jsonld" {
  const jsonld: {
    expand(input: unknown, options: { documentLoader: (url: string) => Promise<unknown>; safe?: boolean }): Promise<unknown[]>;
  };
  export default jsonld;
}
