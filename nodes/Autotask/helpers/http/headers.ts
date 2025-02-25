import type { IAutotaskCredentials, IAuthHeaders } from '../../types';

export function getAutotaskHeaders(
	credentials: IAutotaskCredentials,
	impersonationResourceId?: number,
): IAuthHeaders {
	const headers: IAuthHeaders = {
		APIIntegrationcode: credentials.APIIntegrationcode,
		Username: credentials.Username,
		Secret: credentials.Secret,
		'Content-Type': 'application/json',
	};

	if (impersonationResourceId) {
		headers.ImpersonationResourceId = impersonationResourceId;
	}

	return headers;
}
