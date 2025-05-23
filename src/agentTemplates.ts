export interface AgentTemplate {
  name: string;
  template: string;
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
  },{
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

