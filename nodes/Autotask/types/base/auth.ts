export interface IAutotaskCredentials {
	APIIntegrationcode: string;
	Username: string;
	Secret: string;
	zone: string;
	customZoneUrl?: string;
	timezone: string;
	includeChangeInfoAliasesInOutput?: boolean;
	changeInfoField1Alias?: string;
	changeInfoField2Alias?: string;
	changeInfoField3Alias?: string;
	changeInfoField4Alias?: string;
	changeInfoField5Alias?: string;
}

export interface ICredentialsConfig {
	credentials: IAutotaskCredentials;
	impersonationResourceId?: number;
}

export interface IAuthHeaders {
	APIIntegrationcode: string;
	Username: string;
	Secret: string;
	'Content-Type': string;
	ImpersonationResourceId?: number;
	[key: string]: string | number | undefined;
}
