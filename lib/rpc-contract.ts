export interface RpcCall {
  name: string;
  file: string;
  line: number;
}

const RPC_CALL = /\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;

export function extractRpcCalls(source: string, file: string): RpcCall[] {
  const calls: RpcCall[] = [];
  source.split("\n").forEach((text, index) => {
    RPC_CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RPC_CALL.exec(text)) !== null) {
      calls.push({ name: match[1], file, line: index + 1 });
    }
  });
  return calls;
}

export function findMissingRpcs(calls: RpcCall[], existing: Set<string>): RpcCall[] {
  return calls.filter((call) => !existing.has(call.name));
}
