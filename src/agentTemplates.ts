import * as vscode from 'vscode';

export interface AgentTemplate {
    name: string;
    template: string;
}

export interface CustomAgentTemplate {
    id: string;
    name: string;
    template: string;
    createdAt: string;
}

export const agentTemplates: AgentTemplate[] = [
    {
        name: "Code Agent",
        template:
            `code_agent:
  name: Code Agent
  type: agent
  inputs:
    agent_path: "genor_agents.custom_code.code_agent.CodeAgent"
    init_kwargs:
      code: >
        def main():
    call_kwargs:
      sample_input: "{{ }}"
  outputs:
    - sample_output
  next:
    - sample_next`
    }, {
        name: "Aggregator",
        template:
            `aggregator:
  name: Aggregator
  type: aggregator
  outputs:
    node1:
      param_name: output_param
    node2:
      param_name: output_param
  next:
    - sample_next`
    }, {
        name: "IfElse",
        template:
            `ifelse:
  name: IfElse
  type: ifelse
  conditions:
    - if: ""
      then:
        - sample_next
    - elif: ""
      then:
        - sample_next
    - else:
        - sample_next`
    }, {
        name: "Iterator",
        template:
            `iterator:
  name: Iterator
  type: iterator
  inputs:
    iterable: "{{ }}"
    subgraph:
      nodes:
        
  next:
    - sample_next`
    }, {
        name: "LLM Agent",
        template:
            `llm_agent:
  name: LLM Agent
  type: agent
  inputs:
    agent_path: "genor_agents.llm_agent.llm_agent.LLMAgent"
    init_kwargs:
      model_provider: azureopenai
      hyperparameters:
        model: "gpt-4o"
        response_format: \${}
        convert_to_dict: true
        temperature: 0.001
      system_prompt: \${}
    call_kwargs:
      messages:
        - role: user
          content: "{{ }}"
  outputs:
    - response
  next:
    - sample_next`
    },
];

export class TemplateManager {
    private static readonly STORAGE_KEY = 'genor-yaml-toolkit.customTemplates';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // Get all custom templates from storage
    getCustomTemplates(): CustomAgentTemplate[] {
        return this.context.globalState.get<CustomAgentTemplate[]>(TemplateManager.STORAGE_KEY, []);
    }

    // Save a new custom template
    async saveCustomTemplate(name: string, template: string): Promise<void> {
        const customTemplates = this.getCustomTemplates();

        // Check if template with same name already exists
        const existingIndex = customTemplates.findIndex(t => t.name === name);

        const newTemplate: CustomAgentTemplate = {
            id: this.generateId(),
            name,
            template,
            createdAt: new Date().toISOString()
        };

        if (existingIndex >= 0) {
            // Update existing template
            customTemplates[existingIndex] = newTemplate;
        } else {
            // Add new template
            customTemplates.push(newTemplate);
        }

        await this.context.globalState.update(TemplateManager.STORAGE_KEY, customTemplates);
    }

    // Delete a custom template by ID
    async deleteCustomTemplate(id: string): Promise<void> {
        const customTemplates = this.getCustomTemplates();
        const filteredTemplates = customTemplates.filter(t => t.id !== id);
        await this.context.globalState.update(TemplateManager.STORAGE_KEY, filteredTemplates);
    }

    // Get all templates (built-in + custom)
    getAllTemplates(builtInTemplates: { name: string; template: string }[]): { name: string; template: string; isCustom?: boolean }[] {
        const customTemplates = this.getCustomTemplates();

        return [
            ...builtInTemplates.map(t => ({ ...t, isCustom: false })),
            ...customTemplates.map(t => ({ name: t.name, template: t.template, isCustom: true }))
        ];
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
}