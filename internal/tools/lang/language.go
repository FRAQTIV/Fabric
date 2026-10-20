package lang

import (
	"github.com/danielmiessler/fabric/internal/i18n"
	"github.com/danielmiessler/fabric/internal/plugins"
	"golang.org/x/text/language"
)

func NewLanguage() (ret *Language) {

	label := "Language"
	ret = &Language{}

	ret.PluginBase = &plugins.PluginBase{
		Name:             i18n.T("language_label"),
		SetupDescription: i18n.T("language_setup_description") + " " + i18n.T("optional_marker"),
		EnvNamePrefix:    plugins.BuildEnvVariablePrefix(label),
		ConfigureCustom:  ret.configure,
	}

	ret.DefaultLanguage = ret.AddSetupQuestionWithEnvName("Output", false,
		i18n.T("language_output_question"))

	return
}

type Language struct {
	*plugins.PluginBase
	DefaultLanguage *plugins.SetupQuestion
}

func (o *Language) configure() error {
	if o.DefaultLanguage.Value != "" {
		langTag, err := language.Parse(o.DefaultLanguage.Value)
		if err == nil {
			o.DefaultLanguage.Value = langTag.String()
		} else {
			o.DefaultLanguage.Value = ""
		}
	}

	return nil
}
