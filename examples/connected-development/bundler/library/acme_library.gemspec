require_relative "lib/acme_library/version"

Gem::Specification.new do |spec|
  spec.name = "acme_library"
  spec.version = AcmeLibrary::VERSION
  spec.summary = "Tiny connected-development fixture library."
  spec.authors = ["Acme"]
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.0"
  spec.files = Dir["lib/**/*.rb"]
  spec.require_paths = ["lib"]
end
