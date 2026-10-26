/** The most useful message in an API error response: the first validation message, the error, or `fallback`. */
export const apiError = (err, fallback) => err.response?.data?.details?.[0]?.msg || err.response?.data?.error || fallback;
