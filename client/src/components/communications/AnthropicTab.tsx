import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation } from "@tanstack/react-query";
import { apiJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function AnthropicTab() {
  const { toast } = useToast();
  const [promptText, setPromptText] = useState("");
  const [sentimentText, setSentimentText] = useState("");
  const [communicationIssue, setCommunicationIssue] = useState("");
  const [textToSummarize, setTextToSummarize] = useState("");
  const [activeTab, setActiveTab] = useState("prompt");
  const [responseText, setResponseText] = useState("");
  const [sentimentResult, setSentimentResult] = useState<null | { sentiment: string; confidence: number }>(null);

  // Check if Anthropic API is available
  const statusCheck = useMutation({
    mutationFn: () => apiJson<{available: boolean; model: string}>("/api/anthropic/status"),
    onSuccess: (data) => {
      if (data.available) {
        toast({
          title: "Anthropic API is available",
          description: `Using model: ${data.model}`,
        });
      } else {
        toast({
          title: "Anthropic API is not available",
          description: "Please check your API key configuration",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({
        title: "Failed to check Anthropic API status",
        description: "Please try again later",
        variant: "destructive",
      });
    },
  });

  // Process text prompt
  const processPrompt = useMutation({
    mutationFn: (prompt: string) => apiJson<{response: string}>("/api/anthropic/process-prompt", {
      method: "POST",
      data: { prompt },
    }),
    onSuccess: (data) => {
      setResponseText(data.response);
    },
    onError: () => {
      toast({
        title: "Failed to process prompt",
        description: "Please try again later",
        variant: "destructive",
      });
    },
  });

  // Analyze sentiment
  const analyzeSentiment = useMutation({
    mutationFn: (text: string) => apiJson<{sentiment: string; confidence: number}>("/api/anthropic/analyze-sentiment", {
      method: "POST",
      data: { text },
    }),
    onSuccess: (data) => {
      setSentimentResult({
        sentiment: data.sentiment,
        confidence: data.confidence,
      });
    },
    onError: () => {
      toast({
        title: "Failed to analyze sentiment",
        description: "Please try again later",
        variant: "destructive",
      });
    },
  });

  // Generate communication response
  const generateResponse = useMutation({
    mutationFn: (issue: string) => apiJson<{response: string}>("/api/anthropic/generate-response", {
      method: "POST",
      data: { issue },
    }),
    onSuccess: (data) => {
      setResponseText(data.response);
    },
    onError: () => {
      toast({
        title: "Failed to generate response",
        description: "Please try again later",
        variant: "destructive",
      });
    },
  });

  // Summarize text
  const summarizeTextMutation = useMutation({
    mutationFn: (text: string) => apiJson<{summary: string}>("/api/anthropic/summarize", {
      method: "POST",
      data: { text },
    }),
    onSuccess: (data) => {
      setResponseText(data.summary);
    },
    onError: () => {
      toast({
        title: "Failed to summarize text",
        description: "Please try again later",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    setResponseText("");
    setSentimentResult(null);

    switch (activeTab) {
      case "prompt":
        if (!promptText.trim()) {
          toast({
            title: "Empty prompt",
            description: "Please enter a prompt",
            variant: "destructive",
          });
          return;
        }
        processPrompt.mutate(promptText);
        break;

      case "sentiment":
        if (!sentimentText.trim()) {
          toast({
            title: "Empty text",
            description: "Please enter text to analyze",
            variant: "destructive",
          });
          return;
        }
        analyzeSentiment.mutate(sentimentText);
        break;

      case "communication":
        if (!communicationIssue.trim()) {
          toast({
            title: "Empty issue",
            description: "Please describe the communication issue",
            variant: "destructive",
          });
          return;
        }
        generateResponse.mutate(communicationIssue);
        break;

      case "summarize":
        if (!textToSummarize.trim()) {
          toast({
            title: "Empty text",
            description: "Please enter text to summarize",
            variant: "destructive",
          });
          return;
        }
        summarizeTextMutation.mutate(textToSummarize);
        break;
    }
  };

  const isPending = 
    processPrompt.isPending || 
    analyzeSentiment.isPending || 
    generateResponse.isPending || 
    summarizeTextMutation.isPending ||
    statusCheck.isPending;

  const SentimentResultDisplay = () => {
    if (!sentimentResult) return null;

    const getSentimentColor = () => {
      switch (sentimentResult.sentiment.toLowerCase()) {
        case 'positive': return 'text-green-600';
        case 'negative': return 'text-red-600';
        case 'neutral': return 'text-blue-600';
        default: return 'text-gray-600';
      }
    };

    const getConfidenceLabel = () => {
      const confidence = sentimentResult.confidence;
      if (confidence > 0.8) return 'Very High';
      if (confidence > 0.6) return 'High';
      if (confidence > 0.4) return 'Medium';
      if (confidence > 0.2) return 'Low';
      return 'Very Low';
    };

    return (
      <div className="mt-4 p-4 border rounded-md bg-slate-50">
        <h3 className="font-semibold text-lg mb-2">Sentiment Analysis Result</h3>
        <div className="flex flex-col space-y-2">
          <div className="flex justify-between">
            <span className="font-medium">Sentiment:</span>
            <span className={`font-semibold ${getSentimentColor()}`}>
              {sentimentResult.sentiment.charAt(0).toUpperCase() + sentimentResult.sentiment.slice(1)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Confidence:</span>
            <span className="font-semibold">
              {(sentimentResult.confidence * 100).toFixed(1)}% ({getConfidenceLabel()})
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Anthropic AI Assistance</h2>
        <Button 
          variant="outline" 
          onClick={() => statusCheck.mutate()}
          disabled={isPending}
        >
          {statusCheck.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            "Check API Status"
          )}
        </Button>
      </div>

      <Tabs 
        defaultValue="prompt" 
        className="w-full"
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          setResponseText("");
          setSentimentResult(null);
        }}
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="prompt">General AI</TabsTrigger>
          <TabsTrigger value="sentiment">Sentiment Analysis</TabsTrigger>
          <TabsTrigger value="communication">HR Communication</TabsTrigger>
          <TabsTrigger value="summarize">Text Summarizer</TabsTrigger>
        </TabsList>

        <TabsContent value="prompt">
          <Card>
            <CardHeader>
              <CardTitle>Ask Claude</CardTitle>
              <CardDescription>
                Enter your prompt for Claude to analyze and respond to
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Textarea
                  placeholder="Enter your prompt here..."
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  className="min-h-[150px]"
                />
                <Button 
                  onClick={handleSubmit} 
                  className="w-full"
                  disabled={isPending || !promptText.trim()}
                >
                  {processPrompt.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    "Submit"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sentiment">
          <Card>
            <CardHeader>
              <CardTitle>Sentiment Analysis</CardTitle>
              <CardDescription>
                Analyze the sentiment of text to understand emotional tone
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Textarea
                  placeholder="Enter text to analyze sentiment..."
                  value={sentimentText}
                  onChange={(e) => setSentimentText(e.target.value)}
                  className="min-h-[150px]"
                />
                <Button 
                  onClick={handleSubmit} 
                  className="w-full"
                  disabled={isPending || !sentimentText.trim()}
                >
                  {analyzeSentiment.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    "Analyze Sentiment"
                  )}
                </Button>
                <SentimentResultDisplay />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communication">
          <Card>
            <CardHeader>
              <CardTitle>HR Communication Assistant</CardTitle>
              <CardDescription>
                Get help drafting professional workplace communications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Textarea
                  placeholder="Describe the communication issue or situation..."
                  value={communicationIssue}
                  onChange={(e) => setCommunicationIssue(e.target.value)}
                  className="min-h-[150px]"
                />
                <Button 
                  onClick={handleSubmit} 
                  className="w-full"
                  disabled={isPending || !communicationIssue.trim()}
                >
                  {generateResponse.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    "Generate Response"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summarize">
          <Card>
            <CardHeader>
              <CardTitle>Text Summarizer</CardTitle>
              <CardDescription>
                Condense long text into concise summaries while preserving key points
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Textarea
                  placeholder="Enter text to summarize..."
                  value={textToSummarize}
                  onChange={(e) => setTextToSummarize(e.target.value)}
                  className="min-h-[150px]"
                />
                <Button 
                  onClick={handleSubmit} 
                  className="w-full"
                  disabled={isPending || !textToSummarize.trim()}
                >
                  {summarizeTextMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Summarizing...
                    </>
                  ) : (
                    "Summarize Text"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {responseText && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Response</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap bg-slate-50 p-4 rounded-md border">
              {responseText}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}