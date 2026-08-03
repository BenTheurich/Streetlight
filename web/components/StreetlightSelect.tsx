'use client';

import * as Select from '@radix-ui/react-select';

const EMPTY_VALUE = '__streetlight_empty__';

export type StreetlightSelectOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export function StreetlightSelect({
  ariaLabel,
  disabled,
  id,
  name,
  onValueChange,
  options,
  required,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onValueChange: (value: string) => void;
  options: StreetlightSelectOption[];
  required?: boolean;
  value: string;
}) {
  const radixValue =
    value === '' && options.some((option) => option.value === '') ? EMPTY_VALUE : value;

  return (
    <Select.Root
      disabled={disabled}
      name={name}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_VALUE ? '' : nextValue)}
      required={required}
      value={radixValue}
    >
      <Select.Trigger aria-label={ariaLabel} className="streetlight-select-trigger" id={id}>
        <Select.Value placeholder="Choose an option" />
        <Select.Icon className="streetlight-select-icon">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          align="start"
          className="streetlight-select-content"
          collisionPadding={8}
          position="popper"
          sideOffset={6}
        >
          <Select.ScrollUpButton className="streetlight-select-scroll-button">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </Select.ScrollUpButton>
          <Select.Viewport className="streetlight-select-viewport">
            {options.map((option) => {
              const optionValue = option.value === '' ? EMPTY_VALUE : option.value;
              return (
                <Select.Item
                  className="streetlight-select-item"
                  disabled={option.disabled}
                  key={optionValue}
                  value={optionValue}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="streetlight-select-indicator">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  </Select.ItemIndicator>
                </Select.Item>
              );
            })}
          </Select.Viewport>
          <Select.ScrollDownButton className="streetlight-select-scroll-button">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
