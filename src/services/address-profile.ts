import { LanaClient } from "../lana/client";
import type { AddressProfile } from "../types";

export class AddressProfileService {
  constructor(private readonly lanaClient: LanaClient) {}

  async lookup(address: string): Promise<AddressProfile> {
    const data = await this.lanaClient.getAddressProfile(address);
    return {
      address,
      riskScore: data.riskScore,
      reputation: data.reputation,
      narrative: data.narrative,
      labels: data.labels.slice(0, 8),
      topCounterparties: data.topCounterparties.slice(0, 5),
      firstActivityDate: data.firstActivityDate
    };
  }
}
