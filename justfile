# The package's own binaries come first on PATH, as npm run puts them.
export PATH := justfile_directory() + "/node_modules/.bin:" + env_var("PATH")

# The npm script dev.
dev:
	wrangler dev

# The npm script deploy.
deploy:
	wrangler deploy

# The npm script typecheck.
typecheck:
	tsc

# The npm script test.
test:
	node --experimental-strip-types --test src/*.test.ts
