export { PairingIntent } from "./pairing";
export { AccountEnrollment } from "./enrollment";
import { productionRouter } from "./production";

/** Routes remain closed until each production activation fence is explicit. */
const fetch = (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => productionRouter(request, env, ctx);

export default { fetch } satisfies ExportedHandler<Env>;
