import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@elastic/elasticsearch";
import { checkTokenLimit, calculateTokens } from "../token-limiter.js";
import { unwrapEsResponse, extractMappingProperties } from "../es-response.js";
import {
  flattenMapping,
  calculateMappingStats,
  formatMinimal,
  formatCompact,
  filterFields,
  compareMappings,
  formatComparison,
  type MappingSummary,
} from "../mapping-analyzer.js";

export function registerGetMappings(
  server: McpServer,
  esClient: Client,
  maxTokenCall: number
) {
  server.tool(
    "get_mappings",
    "Get field mappings for Elasticsearch index(es) with intelligent analysis and filtering",
    {
      index: z
        .string()
        .trim()
        .min(1, "Index name is required")
        .describe("Index name or pattern (e.g., 'logs-*', 'my-index')"),

      summary_level: z
        .enum(["minimal", "compact", "full"])
        .optional()
        .default("minimal")
        .describe("Output detail level: minimal (flat list, default), compact (tree structure), full (raw JSON)"),

      field_pattern: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe("Filter fields by pattern(s), e.g., 'user.*' or ['user.*', '@*']"),

      field_type: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe("Filter fields by type(s), e.g., 'keyword' or ['text', 'keyword']"),

      field_capability: z
        .enum(["searchable", "aggregatable", "sortable"])
        .optional()
        .describe("Filter fields by capability: searchable (full-text or term), aggregatable, sortable"),

      show_capabilities: z
        .boolean()
        .optional()
        .default(true)
        .describe("Show field capability tags (default: true)"),

      compare_mode: z
        .boolean()
        .optional()
        .describe("Enable multi-index comparison mode (auto-enabled when index pattern matches multiple)"),

      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations"),
    },
    async ({
      index,
      summary_level,
      field_pattern,
      field_type,
      field_capability,
      show_capabilities,
      compare_mode,
      break_token_rule,
    }) => {
      try {
        // Fetch mappings
        const mappingResponse = unwrapEsResponse<Record<string, any>>(
          await esClient.indices.getMapping({
            index,
          })
        );

        const indexNames = Object.keys(mappingResponse);

        if (indexNames.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No indices found matching pattern: ${index}`,
              },
            ],
          };
        }

        // Process each index
        const summaries: MappingSummary[] = [];
        const hasFilters = !!(field_pattern || field_type || field_capability);
        let totalFieldsBeforeFilter = 0;
        let totalFieldsAfterFilter = 0;

        for (const indexName of indexNames) {
          const indexMapping = mappingResponse[indexName];
          const properties = extractMappingProperties(indexMapping?.mappings);

          // Flatten mapping
          const { fields, maxDepth } = flattenMapping(properties);
          totalFieldsBeforeFilter += fields.length;

          // Apply filters if specified
          let filteredFields = fields;

          if (hasFilters) {
            filteredFields = filterFields(fields, {
              pattern: field_pattern,
              type: field_type,
              capability: field_capability,
            });
          }

          totalFieldsAfterFilter += filteredFields.length;

          // Calculate stats
          const stats = calculateMappingStats(filteredFields, maxDepth);

          summaries.push({
            index: indexName,
            stats,
            fields: filteredFields,
          });
        }

        // Determine output mode
        const shouldCompare = compare_mode || indexNames.length > 1;
        let resultText = '';
        let originalTokens = 0;

        // Calculate original data size for comparison
        if (summary_level !== "full") {
          const originalData = JSON.stringify(mappingResponse, null, 2);
          originalTokens = calculateTokens(originalData);
        }

        if (shouldCompare && indexNames.length > 1) {
          // Multi-index comparison mode
          const comparison = compareMappings(summaries);
          resultText = formatComparison(comparison);

          // Add individual summaries if requested
          if (summary_level !== "minimal") {
            resultText += `\n${'='.repeat(70)}\n`;
            resultText += `\n📋 各索引详情:\n\n`;

            for (const summary of summaries) {
              if (summary_level === "compact") {
                resultText += formatCompact(summary) + '\n';
              }
            }
          }
        } else {
          // Single index or no comparison
          const summary = summaries[0];

          if (summary_level === "full") {
            // Return raw JSON
            resultText = `Raw mapping for: ${summary.index}\n\n`;
            resultText += JSON.stringify(
              mappingResponse[summary.index]?.mappings || {},
              null,
              2
            );
          } else if (summary_level === "compact") {
            resultText = formatCompact(summary);
          } else {
            // minimal (default)
            resultText = formatMinimal(summary);
          }

          // Add filter info if filters were applied
          if (hasFilters) {
            resultText += `\n${'─'.repeat(70)}\n`;
            resultText += `🔍 过滤结果: 显示 ${totalFieldsAfterFilter} / ${totalFieldsBeforeFilter} 个字段\n`;
            
            if (field_pattern) {
              const patterns = Array.isArray(field_pattern) ? field_pattern : [field_pattern];
              resultText += `   Pattern: ${patterns.join(', ')}\n`;
            }
            if (field_type) {
              const types = Array.isArray(field_type) ? field_type : [field_type];
              resultText += `   Type: ${types.join(', ')}\n`;
            }
            if (field_capability) {
              resultText += `   Capability: ${field_capability}\n`;
            }
          }
        }

        // Add token statistics for optimized modes
        if (summary_level !== "full" && originalTokens > 0) {
          const optimizedTokens = calculateTokens(resultText);
          const savings = originalTokens - optimizedTokens;
          const savingsPercent = ((savings / originalTokens) * 100).toFixed(1);

          resultText += `\n${'='.repeat(70)}\n`;
          resultText += `📊 Token 统计:\n`;
          resultText += `   摘要级别:         ${summary_level}\n`;
          resultText += `   原始数据:         ${originalTokens.toLocaleString()} tokens\n`;
          resultText += `   优化后:           ${optimizedTokens.toLocaleString()} tokens\n`;
          resultText += `   节省:             ${savings.toLocaleString()} tokens (${savingsPercent}% ↓)\n`;
          resultText += `   限制:             ${maxTokenCall.toLocaleString()} tokens\n`;
        }

        const result = {
          content: [
            {
              type: "text" as const,
              text: resultText,
            },
          ],
        };

        // Check token limit
        const tokenCheck = checkTokenLimit(result, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          // Suggest using more aggressive filtering
          let suggestion = tokenCheck.error!;
          suggestion += `\n\n当前配置:\n`;
          suggestion += `  - summary_level: ${summary_level}\n`;
          suggestion += `  - 索引数量: ${indexNames.length}\n`;
          
          if (!hasFilters) {
            suggestion += `\n建议:\n`;
            suggestion += `  1. 使用 field_pattern 过滤特定字段 (如 "user.*")\n`;
            suggestion += `  2. 使用 field_type 过滤特定类型 (如 "keyword")\n`;
            suggestion += `  3. 使用更具体的索引名而非通配符\n`;
          } else {
            suggestion += `\n已使用过滤但仍超限，建议:\n`;
            suggestion += `  1. 使用更严格的过滤条件\n`;
            suggestion += `  2. 减少匹配的索引数量\n`;
          }
          
          return {
            content: [
              {
                type: "text" as const,
                text: suggestion,
              },
            ],
            isError: true,
          };
        }

        return result;
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}
