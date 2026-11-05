/*
 * The path a local request is labelled with, by the recording contract's
 * recordedRequestPath rule: each segment that looks opaque (a UUID, 20 or more
 * hex characters, or 20 or more base64url characters mixing letters and
 * digits, as in reset links and signed URLs) is written as [redacted] before
 * the path is cut, so no part of a secret is kept. It needs nothing from PHP,
 * so the rule's test compiles it alone.
 */
#ifndef VIBE64_PATH_H
#define VIBE64_PATH_H

#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#define V64_REDACTED "[redacted]"

static bool v64_hex_digit(unsigned char c)
{
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

static bool v64_opaque_segment(const char *segment, size_t length)
{
	if (length == 36) {
		size_t i = 0;
		while (i < length && ((i == 8 || i == 13 || i == 18 || i == 23)
				? segment[i] == '-' : v64_hex_digit((unsigned char) segment[i]))) {
			i++;
		}
		if (i == length) {
			return true;
		}
	}
	if (length < 20) {
		return false;
	}
	bool hex = true, digit = false, letter = false;
	for (size_t i = 0; i < length; i++) {
		unsigned char c = (unsigned char) segment[i];
		bool is_digit = c >= '0' && c <= '9';
		bool is_letter = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
		if (!is_digit && !is_letter && c != '_' && c != '-') {
			return false;
		}
		hex = hex && v64_hex_digit(c);
		digit = digit || is_digit;
		letter = letter || is_letter;
	}
	return hex || (digit && letter);
}

/*
 * Writes path[0, length) with its opaque segments redacted into out, cut to at
 * most limit bytes on a UTF-8 character boundary. out holds limit + 1 bytes.
 */
static void v64_recorded_path(const char *path, size_t length, char *out, size_t limit)
{
	size_t used = 0;
	int next = -1; /* the first byte left out, once the path is cut */
	for (size_t start = 0; next < 0; start++) {
		size_t end = start;
		while (end < length && path[end] != '/') {
			end++;
		}
		bool opaque = v64_opaque_segment(path + start, end - start);
		const char *text = opaque ? V64_REDACTED : path + start;
		size_t size = opaque ? sizeof(V64_REDACTED) - 1 : end - start;
		/* The segment, then its slash unless it is the last one. */
		for (size_t i = 0; i < size + (end < length) && next < 0; i++) {
			unsigned char c = i < size ? (unsigned char) text[i] : '/';
			if (used == limit) {
				next = c;
			} else {
				out[used++] = (char) c;
			}
		}
		if (end >= length) {
			break;
		}
		start = end;
	}
	while (used && next >= 0 && (next & 0xC0) == 0x80) {
		next = (unsigned char) out[--used];
	}
	out[used] = '\0';
}

#endif
