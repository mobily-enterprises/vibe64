// Package library is the published dependency used by the connected-development fixture.
package library

// Marker identifies which source of the library the consumer was built with.
func Marker() string {
	return "library 1.0.0 published"
}
