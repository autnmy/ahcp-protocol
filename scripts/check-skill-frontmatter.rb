#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Verify every SKILL.md has parseable YAML frontmatter carrying `name` + `description`.
#
# Guards the class of bug where an unquoted `description` containing `: ` (e.g. "Triggers: …")
# is read by YAML as a mapping separator and the frontmatter fails to parse — which means the
# skill silently won't load. `claude plugin validate` does NOT catch this (it only parses the
# marketplace/plugin manifests, not per-skill frontmatter), so this script is the gate.

require "yaml"

# FNM_DOTMATCH so dot-prefixed dirs are scanned too — a project's `.claude/skills/<name>/SKILL.md`
# (the builders' default output location) is otherwise skipped, letting malformed frontmatter slip past.
files = (Dir.glob("**/SKILL.md", File::FNM_DOTMATCH) + Dir.glob("SKILL.md", File::FNM_DOTMATCH)).uniq
          .reject { |f| f.split(File::SEPARATOR).any? { |seg| seg == "node_modules" || seg == ".git" } }
          .sort
abort("::error::no SKILL.md files found") if files.empty?

failed = []
files.each do |f|
  txt = File.read(f, encoding: "UTF-8")
  fm = txt[/\A---\n(.*?)\n---/m, 1]
  if fm.nil?
    failed << "#{f}: missing YAML frontmatter (--- ... --- at the top of the file)"
    next
  end
  begin
    data = YAML.safe_load(fm)
  rescue StandardError => e
    failed << "#{f}: frontmatter is not valid YAML — #{e.message.lines.first.to_s.strip} " \
              "(quote the value or fold it with `>-`)"
    next
  end
  unless data.is_a?(Hash)
    failed << "#{f}: frontmatter is not a YAML mapping"
    next
  end
  %w[name description].each do |key|
    failed << "#{f}: missing or empty `#{key}`" if data[key].nil? || data[key].to_s.strip.empty?
  end
end

if failed.empty?
  puts "OK: #{files.length} SKILL.md frontmatter block(s) parse and carry name + description."
else
  failed.each { |m| puts "::error::#{m}" }
  abort("#{failed.length} SKILL.md frontmatter problem(s)")
end
